// PLS-10 L2: real dsh Host, real Ledger/local files and local stand-in Jobs.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ExecutionActionRequest, ExecutionContext, GrowthProposal, LedgerRecord, RevisionProposal, RunView } from '@hima/harness';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { jobRecords, killSessions, localHome, recordsOf, sessionsOf, waitUntil } from './support/fabric.ts';
import { packDigestOf } from '@hima/harness';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

import { prepared, dispose, identity } from './support/growth.ts';

test('native growth attaches mechanical identities without asking the Agent to copy hashes and keeps retries idempotent', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const { method, parent: _parent, inputThroughSeq: _seq, inputs: _inputs, ...intent } = f.proposal('native-intent');
    const control = f.context().run.control!;
    const args = { run: f.runId, action: 'grow', expectedEpoch: control.epoch, expectedRevision: control.revision,
      requestId: 'native-business-intent', proposal: intent };
    const execute = async (arguments_: Record<string, unknown>) => {
      const result = await f.host.ctx.tools.execute({ name: 'hima_execute', arguments: arguments_, agent: f.agent,
        callId: 'native-growth-check' as never, signal: AbortSignal.timeout(10_000) });
      assert.equal(result.isError, false);
      return (result as unknown as { value: { kind: string; reason?: string } }).value;
    };
    const accepted = await execute(args);
    assert.equal(accepted.kind, 'accepted', accepted.reason);
    assert.equal((await execute(args)).kind, 'duplicate', 'identical retry reuses the original canonical boundary');
    const proposed = recordsOf(f.host, f.runId).find(record => record.type === 'growth' && record.event === 'proposed');
    assert.ok(proposed?.type === 'growth');
    const canonical = proposed.proposal as unknown as GrowthProposal;
    assert.deepEqual(canonical.method, method);
    assert.ok(canonical.inputs.length > 0 && canonical.inputs.every(input => /^[0-9a-f]{64}$/.test(input.contentIdentity)));
    await f.call({ action: 'grow', proposalId: intent.proposalId, growthDisposition: 'abandoned' });
    const now = f.context().run.control!;
    const wrong = await execute({ ...args, expectedEpoch: now.epoch, expectedRevision: now.revision, requestId: 'native-explicit-wrong',
      proposal: { ...intent, proposalId: 'explicit-wrong', method: { ...method, digest: 'f'.repeat(64) } } });
    assert.equal(wrong.kind, 'refused');
    assert.match(wrong.reason ?? '', /method/);
  } finally { await dispose(f); }
});

test('the Campaign attempt limit refuses valid new growth and strategy-only revision while preserving analysis', async (t) => {
  const f = await prepared(t, 120_000, 2);
  try {
    await f.reachGrowth();
    assert.equal(f.context().run.meters?.attempts, 2);
    assert.equal(f.context().budget.attemptRemaining, 0);
    const growth = await f.call({ action: 'grow', proposal: f.proposal('cap-valid-growth') });
    assert.equal(growth.kind, 'refused');
    assert.match(growth.reason!, /attempt limit is exhausted/);
    assert.ok(recordsOf(f.host, f.runId).some((record) => record.type === 'growth'
      && record.proposalId === 'cap-valid-growth' && record.event === 'rejected'));

    const context = f.context();
    const workspace = recordsOf(f.host, f.runId).find((record) => record.type === 'workspace')!;
    const revision: RevisionProposal = {
      revisionId: 'cap-strategy-only', method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
      inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: workspace.id, contentIdentity: identity(workspace) }],
      reason: 'retry the reference route with a different declared strategy', changedNodes: ['synthesize'],
      affectedNodes: ['synthesize', 'read-qor', 'judge', 'next-period'], changes: [], strategy: { periodNs: 2.2 },
    };
    const revised = await f.call({ action: 'revise', revision });
    assert.equal(revised.kind, 'refused');
    assert.match(revised.reason!, /attempt limit is exhausted/);
    assert.equal(f.context().run.strategy?.periodNs, 2.3, 'the refused strategy-only revision changes no Run strategy');
    assert.equal(recordsOf(f.host, f.runId).some((record) => record.type === 'revision'
      && record.revisionId === revision.revisionId && record.event === 'applied'), false);
    const analyzed = await f.call({ action: 'analyze', nodeId: 'next-period', analysis: {
      question: 'Why did experimentation stop?', hypotheses: [], comparisons: [], claims: [],
      limitations: ['The Campaign used its two declared act attempts.'],
      nextExperiments: ['Unexecuted: the proposed growth branch and revised strategy.'],
    } });
    assert.equal(analyzed.kind, 'accepted', JSON.stringify(analyzed));
    assert.equal(f.context().run.meters?.attempts, 2, 'analysis consumes no experimental attempt');
  } finally { await dispose(f); }
});

test('a grown node cannot reset the Campaign attempt pool, including after Host restart', async (t) => {
  const f = await prepared(t, 120_000, 3);
  let second: InProcessHost | undefined;
  try {
    await f.reachGrowth();
    assert.equal((await f.call({ action: 'grow', proposal: f.proposal('cap-grown-route') })).kind, 'accepted');
    await f.node('growth-synthesize');
    assert.equal(f.context().run.meters?.attempts, 3);
    assert.deepEqual(f.context().available, [], 'the next grown act node receives no fresh pool');
    const refused = await f.call({ action: 'begin', nodeId: 'growth-read' });
    assert.equal(refused.kind, 'refused');
    assert.match(refused.reason!, /attempt limit is exhausted/);

    const ownerId = String(f.agent.id);
    await f.host.dispose();
    second = await bootInProcess(f.home.h);
    const agents = second.ctx.get('agents');
    const defaultModel = second.ctx.get('agentDefaultModel');
    assert.ok(agents && defaultModel);
    const selection = defaultModel.currentSelection();
    await agents.resume({ resumeSessionId: ownerId as never, agentOptions: { provider: selection.provider, model: selection.model } });
    const context = second.ctx.hima.executionContext(f.runId);
    assert.equal(context.run.meters?.attempts, 3);
    assert.equal(context.budget.attemptRemaining, 0);
    assert.deepEqual(context.available, []);
    const control = context.run.control!;
    const afterRestart = await second.ctx.hima.executionAction({ runId: f.runId, actor: ownerId,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: 'cap-after-restart',
      action: 'begin', nodeId: 'growth-read' });
    assert.equal(afterRestart.kind, 'refused');
    assert.match(afterRestart.reason!, /attempt limit is exhausted/);
  } finally {
    const active = second;
    if (active) { killSessions(sessionsOf(active, f.runId)); await active.ctx.hima.cancelRun(f.runId); await active.dispose(); }
    else await dispose(f);
    await f.home.h.dispose().catch(() => undefined);
  }
});


test('an owner accepts, executes and returns from one additive branch with actual evidence and idempotent proposals', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const proposal = f.proposal();
    for (const input of proposal.inputs) assert.equal(f.context().evidence?.find(item => item.recordId === input.recordId)?.contentIdentity, input.contentIdentity, 'the model receives the exact canonical input identity, not a file hash it must reinterpret');
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


test('closing reserve permits an evidence-backed Judge and Explore settlement without another experiment', async (t) => {
  const f = await prepared(t, 120_000, undefined, 30_000, 2.5);
  try {
    await f.node('synthesize'); await f.node('read-qor');
    const launches = jobRecords(f.host, f.runId).filter(record => record.event === 'launched').length;
    // Move only Date beyond the experiment boundary; native timers and Jobs are not replayed.
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(f.context().run.createdAt) + 100_000 });
    assert.equal(f.context().budget.phase, 'closing');
    assert.deepEqual(f.context().available, ['judge']);
    await f.node('judge');
    const begun = await f.call({ action: 'begin', nodeId: 'next-period' }); assert.equal(begun.kind, 'accepted');
    const executionId = begun.receipt!.executionId!;
    assert.equal((await f.call({ action: 'work', executionId })).kind, 'accepted');
    const records = recordsOf(f.host, f.runId);
    const cites = records.filter(record => record.type === 'observation' || record.type === 'verdict').map(record => record.id);
    const next = await f.call({ action: 'complete', executionId, decision: 'next-strategy', strategy: { periodNs: 2.2 }, rationale: 'Try another experiment', cites });
    assert.equal(next.kind, 'refused'); assert.match(next.reason!, /closing reserve/);
    const done = await f.call({ action: 'complete', executionId, decision: 'goal-met', rationale: 'Only the existing measured fixture Goal is met.', cites });
    assert.equal(done.kind, 'accepted', done.reason);
    assert.equal(f.context().run.status, 'ended-goal-met');
    assert.equal(jobRecords(f.host, f.runId).filter(record => record.event === 'launched').length, launches);
  } finally { t.mock.timers.reset(); await dispose(f); }
});


test('growth after a revision rejects old same-generation evidence even with its correct hash', async (t) => {
  const f = await prepared(t);
  try {
    await f.reachGrowth();
    const old = recordsOf(f.host, f.runId).find(record => record.type === 'observation')!;
    const workspace = recordsOf(f.host, f.runId).find(record => record.type === 'workspace')!;
    const context = f.context();
    const revision: RevisionProposal = { revisionId: 'growth-input-version',
      method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
      inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: workspace.id, contentIdentity: identity(workspace) }],
      reason: 'Change the measured strategy and invalidate its former dependent evidence',
      changedNodes: ['synthesize'], affectedNodes: ['synthesize', 'read-qor', 'judge', 'next-period'],
      changes: [], strategy: { periodNs: 2.2 } };
    const revised = await f.call({ action: 'revise', revision }); assert.equal(revised.kind, 'accepted', revised.reason);
    await f.reachGrowth();
    const launches = jobRecords(f.host, f.runId).filter(record => record.event === 'launched').length;
    const stale = await f.call({ action: 'grow', proposal: { ...f.proposal('stale-after-revision'),
      inputs: [{ recordId: old.id, contentIdentity: identity(old) }] } });
    assert.equal(stale.kind, 'refused'); assert.match(stale.reason!, /superseded/);
    assert.equal(jobRecords(f.host, f.runId).filter(record => record.event === 'launched').length, launches);
    const fresh = recordsOf(f.host, f.runId).findLast(record => record.type === 'observation')!;
    assert.notEqual(fresh.id, old.id);
    const accepted = await f.call({ action: 'grow', proposal: { ...f.proposal('fresh-after-revision'),
      inputs: [{ recordId: fresh.id, contentIdentity: identity(fresh) }] } });
    assert.equal(accepted.kind, 'accepted', accepted.reason);
  } finally { await dispose(f); }
});
