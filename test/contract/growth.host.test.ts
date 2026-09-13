// PLS-10 L2: real dsh Host, real Ledger/local files and local stand-in Jobs.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ExecutionActionRequest, ExecutionContext, GrowthProposal, LedgerRecord, RunView } from '@hima/harness';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { jobRecords, killSessions, localHome, recordsOf, sessionsOf, waitUntil } from './support/fabric.ts';
import { packDigestOf } from '@hima/harness';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

import { prepared, dispose } from './support/growth.ts';

test('an owner accepts, executes and returns from one additive branch with actual evidence and idempotent proposals', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const proposal = f.proposal();
    const beforeJobs = jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length;
    const accepted = await f.call({ action: 'grow', proposal }, 'accept-growth');
    assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
    assert.equal(f.context().run.currentNode, 'growth-synthesize');
    assert.equal(packDigestOf(`${packsDirOf(f.home.h)}/${f.pack}`), f.referenceDigest, 'the reference Pack bytes stay unchanged');
    assert.equal((await f.call({ action: 'grow', proposal }, 'same-proposal-new-request')).kind, 'duplicate', 'same proposal identity is idempotent across request ids');
    assert.equal(jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length, beforeJobs, 'acceptance starts no Job');
    for (const id of ['growth-synthesize', 'growth-read', 'growth-judge']) await f.node(id);
    assert.deepEqual(f.context().available, ['next-period']);
    const events = recordsOf(f.host, f.runId).filter((record) => record.type === 'growth').map((record) => record.event);
    assert.deepEqual(events, ['proposed', 'accepted', 'started', 'completed', 'returned']);
    const returned = recordsOf(f.host, f.runId).findLast((record) => record.type === 'growth' && record.event === 'returned');
    assert.ok(returned?.type === 'growth' && returned.evidence && returned.evidence.length >= 4, JSON.stringify(returned));
    const remote = await import(new URL('../../packages/harness/lib/remote.js', import.meta.url).href);
    const view = remote.runView(f.host.ctx.hima.ledger, f.host.ctx.hima.ledger.run(f.runId)!) as RunView;
    assert.equal(view.generations[0]?.growths?.[0]?.event, 'returned');
    assert.deepEqual(view.generations[0]?.growths?.[0]?.nodes.map((node) => node.nodeId).filter((id, i, all) => all.indexOf(id) === i), ['growth-synthesize', 'growth-read', 'growth-judge']);
  } finally { await dispose(f); }
});

test('semantic refusals are durable and start no added Job', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const changes: [string, (base: GrowthProposal) => GrowthProposal][] = [
      ['declared only at top-level', (base) => ({ ...base, proposalId: 'bad-parent', parent: { ...base.parent, nodeId: 'missing' } })],
      ['reference graph', (base) => ({ ...base, proposalId: 'duplicate-node', nodes: [{ ...base.nodes[0]!, id: 'synthesize' }] })],
      ['only leave added nodes', (base) => ({ ...base, proposalId: 'rewrite-edge', edges: [{ from: 'next-period', to: 'growth-synthesize' }] })],
      ['cycle', (base) => ({ ...base, proposalId: 'illegal-cycle', edges: [...base.edges, { from: 'growth-read', to: 'growth-synthesize' }] })],
      ['return to its declared parent', (base) => ({ ...base, proposalId: 'missing-return', returnNode: 'judge' })],
      ['required output', (base) => ({ ...base, proposalId: 'missing-output', requiredOutputs: ['synthesisLog'] })],
      ['Fabric authority', (base) => ({ ...base, proposalId: 'path-override', nodes: [{ id: 'growth-synthesize', kind: 'act', parameters: { tool: 'synth', arguments: { WORKSPACE: '/tmp/escape' } } }] })],
    ];
    const beforeJobs = jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length;
    for (const [reason, change] of changes) {
      const refused = await f.call({ action: 'grow', proposal: change(f.proposal()) });
      assert.equal(refused.kind, 'refused', JSON.stringify(refused));
      assert.match(refused.reason!, new RegExp(reason));
    }
    const rejected = recordsOf(f.host, f.runId).filter((record) => record.type === 'growth' && record.event === 'rejected');
    assert.equal(rejected.length, changes.length, JSON.stringify(rejected));
    assert.equal(jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length, beforeJobs);
    const wrongIdentity = f.proposal('wrong-input');
    wrongIdentity.inputs[0] = { ...wrongIdentity.inputs[0]!, contentIdentity: 'f'.repeat(64) };
    const refused = await f.call({ action: 'grow', proposal: wrongIdentity });
    assert.equal(refused.kind, 'refused');
    assert.match(refused.reason!, /content identity/);
  } finally { await dispose(f); }
});

test('accepted growth reconstructs after Host restart without insertion or launch replay', async (t) => {
  const f = await prepared(t);
  let second: InProcessHost | undefined;
  try {
    await f.reachGrowth();
    assert.equal((await f.call({ action: 'grow', proposal: f.proposal() })).kind, 'accepted');
    // Crash-window counterexample: acceptance is durable before the Run-row move. Put the row back
    // at its parent to model an interruption between those writes; reconstruction must still expose
    // the accepted entry and never append or launch it again.
    await f.host.ctx.hima.ledger.advanceRun(f.runId, { currentNode: 'next-period' });
    const growthCount = recordsOf(f.host, f.runId).filter((record) => record.type === 'growth').length;
    const launches = jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length;
    await f.host.dispose();
    second = await bootInProcess(f.home.h);
    await second.ctx.hima.reconciled;
    const context = second.ctx.hima.executionContext(f.runId);
    assert.equal(context.run.currentNode, 'next-period');
    assert.deepEqual(context.available, ['growth-synthesize']);
    assert.equal(context.growths.find((growth) => growth.event === 'accepted')?.entry, 'growth-synthesize');
    assert.equal(recordsOf(second, f.runId).filter((record) => record.type === 'growth').length, growthCount);
    assert.equal(jobRecords(second, f.runId).filter((record) => record.event === 'launched').length, launches);
  } finally {
    killSessions(second ? sessionsOf(second, f.runId) : []);
    await second?.dispose();
    await f.home.h.dispose();
  }
});

test('return is refused until current required observations and verdicts exist, while optional abandon returns to the same reference check', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const base = f.proposal('evidence-gate');
    const constraint = recordsOf(f.host, f.runId).findLast((record) => record.type === 'verdict' && record.ruleId === 'setup-wns-all-nonnegative');
    assert.equal(constraint?.type, 'verdict');
    if (constraint?.type !== 'verdict') return;
    const other = ['PASS', 'FAIL', 'UNDETERMINED'].filter((outcome) => outcome !== constraint.outcome) as ('PASS' | 'FAIL' | 'UNDETERMINED')[];
    const proposal: GrowthProposal = {
      ...base,
      nodes: [
        { id: 'growth-gate-judge', kind: 'judge', parameters: { rules: ['setup-wns-all-nonnegative', 'clock-period-at-most'], bind: { target_period_ns: { from: 'goal', name: 'target_period_ns' } } } },
        { id: 'growth-gate-read', kind: 'act', parameters: { observes: 'qorReport', arguments: {} } },
      ],
      edges: [
        { from: 'growth-gate-judge', to: 'next-period', outcome: constraint.outcome },
        ...other.map((outcome) => ({ from: 'growth-gate-judge', to: 'growth-gate-read', outcome })),
        { from: 'growth-gate-read', to: 'next-period' },
      ],
    };
    const accepted = await f.call({ action: 'grow', proposal });
    assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
    const begun = await f.call({ action: 'begin', nodeId: 'growth-gate-judge' });
    const executionId = begun.receipt?.executionId!;
    assert.equal((await f.call({ action: 'work', executionId })).kind, 'accepted');
    await waitUntil('growth evidence gate judge ready', () => f.context().executions.some((execution) => execution.id === executionId && execution.phase === 'ready'), 20_000, 20);
    const refused = await f.call({ action: 'complete', executionId });
    assert.equal(refused.kind, 'refused');
    assert.match(refused.reason!, /required growth output/);
    assert.equal(f.context().run.currentNode, 'growth-gate-judge');
    const abandoned = await f.call({ action: 'grow', proposalId: proposal.proposalId, growthDisposition: 'abandoned', rationale: 'The optional detour did not produce its required new observation.' });
    assert.equal(abandoned.kind, 'accepted', JSON.stringify(abandoned));
    assert.deepEqual(f.context().available, ['next-period'], 'the original reference Explore/check still must execute');
  } finally { await dispose(f); }
});

test('optional growth preserves abandoned, cancelled and actual failed outcomes and returns without skipping the parent', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const rename = (proposal: GrowthProposal, proposalId: string, suffix: string): GrowthProposal => {
      const ids = new Map(proposal.nodes.map((node) => [node.id, `${node.id}-${suffix}`]));
      return {
        ...proposal, proposalId,
        nodes: proposal.nodes.map((node) => ({ ...node, id: ids.get(node.id)! })),
        edges: proposal.edges.map((edge) => ({ ...edge, from: ids.get(edge.from)!, to: ids.get(edge.to) ?? edge.to })),
      };
    };
    for (const disposition of ['abandoned', 'cancelled'] as const) {
      const proposal = rename(f.proposal(`optional-${disposition}`), `optional-${disposition}`, disposition);
      assert.equal((await f.call({ action: 'grow', proposal })).kind, 'accepted');
      assert.equal((await f.call({ action: 'grow', proposalId: proposal.proposalId, growthDisposition: disposition, rationale: `owner marked ${disposition}` })).kind, 'accepted');
      assert.deepEqual(f.context().available, ['next-period']);
    }
    const proposal = f.proposal('optional-failed');
    proposal.nodes = [
      { id: 'growth-failing-tool', kind: 'act', parameters: { tool: 'synth', arguments: { PERIOD_NS: 'not-a-number' } } },
      { id: 'growth-failing-read', kind: 'act', parameters: { observes: 'qorReport', arguments: {} } },
    ];
    proposal.edges = [{ from: 'growth-failing-tool', to: 'growth-failing-read' }, { from: 'growth-failing-read', to: 'next-period' }];
    assert.equal((await f.call({ action: 'grow', proposal })).kind, 'accepted');
    const begun = await f.call({ action: 'begin', nodeId: 'growth-failing-tool' });
    const executionId = begun.receipt?.executionId!;
    assert.equal((await f.call({ action: 'work', executionId })).kind, 'accepted');
    await waitUntil('optional growth failure recorded', () => f.context().executions.some((execution) => execution.id === executionId && execution.phase === 'failed'), 20_000, 20);
    assert.equal((await f.call({ action: 'grow', proposalId: proposal.proposalId, growthDisposition: 'failed', rationale: 'The optional experiment failed in its actual local Job.' })).kind, 'accepted');
    assert.deepEqual(f.context().available, ['next-period']);
    const outcomes = recordsOf(f.host, f.runId).flatMap((record) => record.type === 'growth' && ['abandoned', 'cancelled', 'failed'].includes(record.event) ? [record.event] : []);
    assert.deepEqual(outcomes, ['abandoned', 'cancelled', 'failed']);
  } finally { await dispose(f); }
});

test('restart before acceptance retains only the reference point and starts nothing', async (t) => {
  const f = await prepared(t);
  let second: InProcessHost | undefined;
  try {
    await f.reachGrowth();
    const launches = jobRecords(f.host, f.runId).filter((record) => record.event === 'launched').length;
    await f.host.dispose();
    second = await bootInProcess(f.home.h);
    await second.ctx.hima.reconciled;
    const context = second.ctx.hima.executionContext(f.runId);
    assert.deepEqual(context.available, ['next-period']);
    assert.deepEqual(context.growths, []);
    assert.equal(jobRecords(second, f.runId).filter((record) => record.event === 'launched').length, launches);
  } finally {
    killSessions(second ? sessionsOf(second, f.runId) : []);
    await second?.dispose();
    await f.home.h.dispose();
  }
});

test('exhausted time budget refuses growth with evidence', async (t) => {
  const f = await prepared(t, 1);
  try {
    await waitUntil('one millisecond time box settles', () => f.context().run.status === 'ended-budget-exhausted', 5_000, 10);
    const proposal = f.proposal('no-budget');
    const result = await f.call({ action: 'grow', proposal });
    assert.equal(result.kind, 'refused');
    assert.match(result.reason!, /time box is exhausted/);
    assert.ok(recordsOf(f.host, f.runId).some((record) => record.type === 'growth' && record.event === 'rejected' && record.proposalId === 'no-budget'));
  } finally { await dispose(f); }
});
