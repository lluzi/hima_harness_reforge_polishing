// PLS-19: deterministic calls by a real conversational owner, real Host/local Jobs.
// These cases prove execution mechanics, not model reasoning or EDA results.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionActionRequest, ExecutionContext, RunView } from '@hima/harness';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { jobRecords, killSessions, localHome, recordsOf, sessionsOf, waitUntil } from './support/fabric.ts';
import { installDrillDown, installFork, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';

// The file has its own Node test process. Notifications must not request a real model turn.
process.env.HIMA_TEST_SILENT_AGENT = '1';

type Action = Pick<ExecutionActionRequest, 'action' | 'nodeId' | 'executionId' | 'decision' | 'strategy' | 'rationale' | 'cites' | 'origin'>;
type NodeExecution = ExecutionContext['executions'][number];

/** Calls are explicit in the cases below; this helper never picks or executes a successor. */
function ownedCalls(host: InProcessHost, runId: string, actor: string) {
  let request = 0;
  const context = (): ExecutionContext => host.ctx.hima.executionContext(runId);
  const launched = () => jobRecords(host, runId).filter((record) => record.event === 'launched');
  const call = (action: Action) => {
    const control = context().run.control;
    assert.ok(control);
    return host.ctx.hima.executionAction({
      runId, actor, expectedEpoch: control.epoch, expectedRevision: control.revision,
      requestId: `graph-${++request}`, ...action,
    });
  };
  const execution = (executionId: string): NodeExecution => {
    const found = context().executions.find((item) => item.id === executionId);
    assert.ok(found, `context retains execution ${executionId}`);
    return found;
  };
  const ready = async (nodeId: string) => {
    assert.ok(context().available.includes(nodeId), `${nodeId} is an explicit available candidate: ${JSON.stringify(context())}`);
    const before = context().executions.length;
    const begun = await call({ action: 'begin', nodeId });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId, 'begin returns the durable execution to use for work and completion');
    assert.equal(execution(executionId).nodeId, nodeId);
    assert.equal(execution(executionId).phase, 'begun');
    assert.equal(context().executions.length, before + 1);
    assert.equal(execution(executionId).methodDigest, context().run.packDigest);
    assert.match(execution(executionId).inputDigest, /^[a-f0-9]{64}$/);
    const worked = await call({ action: 'work', nodeId, executionId });
    assert.equal(worked.kind, 'accepted', `explicit work for ${nodeId}: ${JSON.stringify(worked)}`);
    await waitUntil(`${nodeId} settles its own work`, () => ['ready', 'failed'].includes(execution(executionId).phase), 30_000, 25);
    assert.equal(execution(executionId).phase, 'ready', JSON.stringify(context()));
    assert.equal(context().executions.length, before + 1, 'work admitted only the requested node');
    return executionId;
  };
  const complete = async (nodeId: string, executionId: string, decision: Omit<Action, 'action' | 'nodeId' | 'executionId'> = {}) => {
    const jobs = launched().length;
    const executions = context().executions.length;
    const result = await call({ action: 'complete', nodeId, executionId, ...decision });
    assert.equal(result.kind, 'accepted', `complete ${nodeId}: ${JSON.stringify(result)}`);
    assert.equal(execution(executionId).phase, 'completed');
    assert.equal(launched().length, jobs, 'completing a node starts no successor Job');
    assert.equal(context().executions.length, executions, 'completion exposes candidates without claiming them');
    return result.context;
  };
  const node = async (nodeId: string) => complete(nodeId, await ready(nodeId));
  const cites = () => {
    const run = context().run;
    return recordsOf(host, runId).filter((record) =>
      (record.type === 'observation' || record.type === 'verdict')
      && record.generation === (run.loop?.generation ?? run.generation)
      && record.loopId === run.loop?.id,
    ).map((record) => record.id);
  };
  return { context, launched, call, execution, ready, complete, node, cites };
}

async function campaign(
  t: TestContext,
  options: { variant?: 'fork' | 'loop' | 'bad-advice' | 'wait'; generationLimit?: number; goal?: number; period?: number },
  check: (owner: ReturnType<typeof ownedCalls>, host: InProcessHost, runId: string) => Promise<void>,
) {
  const home = await localHome(t, { sleepSeconds: 0.01, parallelJobs: 2, licences: { 'Design-Compiler': 2 } });
  assert.ok(home, 'the local stand-in home must be available');
  let host: InProcessHost | undefined;
  let runId: string | undefined;
  try {
    let pack = options.variant === 'fork'
      ? await installFork(packsDirOf(home.h), 'agent-graph-fork', 2.2)
      : options.variant === 'loop'
        ? await installDrillDown(packsDirOf(home.h), 'agent-graph-loop', 2)
        : timingProbePackId;
    if (options.variant === 'bad-advice' || options.variant === 'wait') {
      pack = `agent-graph-${options.variant}`;
      await writePackVariant(packsDirOf(home.h), pack, [], options.variant === 'bad-advice'
        ? [['stepNs: 0.05', 'stepNs: 20']]
        : [['entry: synthesize', 'entry: blocked'], ['edges:', 'edges:\n  - { from: blocked, to: synthesize }']]);
    }
    host = await bootInProcess(home.h);
    const agent = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({
      pack, site: 'local', ownerSessionId: String(agent.id),
      goal: { target_period_ns: options.goal ?? 2.0 }, strategy: { periodNs: options.period ?? 2.3 },
      generationLimit: options.generationLimit ?? 3,
    });
    assert.equal(started.kind, 'ran', JSON.stringify(started));
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const owner = ownedCalls(host, runId, String(agent.id));
    assert.equal(owner.context().run.control?.owner, String(agent.id));
    assert.equal(owner.launched().length, 0, 'preparation launches no business Job');
    await check(owner, host, runId);
  } finally {
    if (host && runId) {
      try { await host.ctx.hima.cancelRun(runId); }
      finally { killSessions(sessionsOf(host, runId)); }
    }
    try { await host?.dispose(); } finally { await home.h.dispose(); }
  }
}

test('explore rejects invented success and invalid strategy, then follows the owner choice and actual goal evidence', async (t) => {
  await campaign(t, { goal: 2.3, period: 2.4 }, async (owner, host, runId) => {
    await owner.node('synthesize');
    assert.deepEqual(owner.context().available, ['read-qor']);
    await owner.node('read-qor');
    await owner.node('judge');
    const explore = await owner.ready('next-period');
    assert.equal(owner.launched().length, 1);
    assert.equal(recordsOf(host, runId).filter((record) => record.type === 'decision').length, 0, 'explore work has not run the fixed chooser');
    const firstCites = owner.cites();
    assert.ok(firstCites.length >= 3, 'the decision cites actual observation and judge records');
    const before = owner.context().run.control?.revision;
    const falseSuccess = await owner.call({
      action: 'complete', nodeId: 'next-period', executionId: explore,
      decision: 'goal-met', rationale: 'Request success despite the measured 2.40 ns missing the 2.30 ns goal.', cites: firstCites,
    });
    assert.equal(falseSuccess.kind, 'refused', 'words cannot override the failing goal verdict');
    const invalid = await owner.call({
      action: 'complete', nodeId: 'next-period', executionId: explore,
      decision: 'next-strategy', strategy: { periodNs: -1 }, rationale: 'Outside the Pack strategy domain.', cites: firstCites,
    });
    assert.equal(invalid.kind, 'refused', 'the owner cannot bypass the Pack strategy domain');
    assert.equal(owner.context().run.control?.revision, before, 'refused decisions change no control facts');
    assert.equal(owner.execution(explore).phase, 'ready');
    const inventedConvergence = await owner.call({ action: 'complete', nodeId: 'next-period', executionId: explore,
      decision: 'converged', rationale: 'Claim stability from a single generation.', cites: firstCites });
    assert.equal(inventedConvergence.kind, 'refused', 'one actual generation cannot establish the declared multi-generation stability');

    // The declared chooser would tighten 2.40 by its 0.05 step to 2.35. This owner chooses 2.30.
    await owner.complete('next-period', explore, {
      decision: 'next-strategy', strategy: { periodNs: 2.3 },
      rationale: 'Test the requested goal directly after the valid 2.40 ns trial.', cites: firstCites,
    });
    assert.deepEqual(owner.context().run.strategy, { periodNs: 2.3 });
    assert.equal(owner.context().run.generation, 2);
    assert.deepEqual(owner.context().available, ['synthesize']);
    assert.equal(owner.launched().length, 1, 'opening generation 2 does not run it');
    const decision = recordsOf(host, runId).findLast((record) => record.type === 'decision');
    assert.equal(decision?.type, 'decision');
    if (decision?.type === 'decision') assert.deepEqual(decision.chosen, { strategy: { periodNs: 2.3 } });
    const remote = await import(new URL('../../packages/harness/lib/remote.js', import.meta.url).href);
    const projected = remote.runView(host.ctx.hima.ledger, host.ctx.hima.ledger.run(runId)!) as RunView;
    assert.equal(projected.decision?.agent?.rationale, 'Test the requested goal directly after the valid 2.40 ns trial.');
    assert.equal(projected.decision?.agent?.executionId, explore);
    assert.equal(projected.decision?.agent?.sessionId, owner.context().run.control?.owner);

    await owner.node('synthesize');
    await owner.node('read-qor');
    await owner.node('judge');
    const final = await owner.ready('next-period');
    const stale = await owner.call({ action: 'complete', nodeId: 'next-period', executionId: final,
      decision: 'goal-met', rationale: 'Reuse evidence from the earlier failed generation.', cites: firstCites });
    assert.equal(stale.kind, 'refused', 'prior generation citations cannot support a current success claim');
    assert.equal(owner.execution(final).phase, 'ready');
    await owner.complete('next-period', final, {
      decision: 'goal-met', rationale: 'The second trial passes the setup and goal rules.', cites: owner.cites(),
    });
    assert.equal(owner.context().run.status, 'ended-goal-met');
    assert.deepEqual(owner.context().available, []);
    assert.equal(owner.launched().length, 2);
    assert.deepEqual(owner.launched().map((job) => job.generation), [1, 2]);
  });
});

test('a valid next-strategy request at the generation budget records an honest ending without another Job', async (t) => {
  await campaign(t, { generationLimit: 1 }, async (owner, host, runId) => {
    await owner.node('synthesize');
    await owner.node('read-qor');
    await owner.node('judge');
    const explore = await owner.ready('next-period');
    await owner.complete('next-period', explore, {
      decision: 'next-strategy', strategy: { periodNs: 2.27 },
      rationale: 'A tighter candidate remains untested because the generation allowance is spent.', cites: owner.cites(),
    });
    const ended = owner.context();
    assert.equal(ended.run.status, 'ended-budget-exhausted');
    assert.equal(ended.run.meters?.endedBy, 'generation-limit');
    assert.equal(ended.run.generation, 1);
    assert.deepEqual(ended.available, []);
    assert.equal(owner.launched().length, 1);
    assert.equal(ended.run.meters?.jobsLaunched, 1);
    assert.ok(recordsOf(host, runId).filter((record) => record.type === 'observation').every((record) => record.generation === 1));
    const again = await owner.call({ action: 'begin', nodeId: 'synthesize' });
    assert.equal(again.kind, 'refused', 'the owner cannot open a generation beyond the total budget');
    assert.equal(owner.launched().length, 1);
  });
});

test('fork branches require explicit work, node pause fences dependents only, and join uses each branch evidence', async (t) => {
  await campaign(t, { variant: 'fork', period: 2.0 }, async (owner, host, runId) => {
    await owner.node('start');
    assert.deepEqual([...owner.context().available].sort(), ['synth-b', 'synthesize']);
    assert.equal(owner.launched().length, 0, 'opening a fork starts neither branch');
    const earlyJoin = await owner.call({ action: 'begin', nodeId: 'judge' });
    assert.equal(earlyJoin.kind, 'refused');

    await owner.node('synthesize');
    assert.equal(owner.launched().length, 1, 'one requested branch is one Job');
    assert.deepEqual([...owner.context().available].sort(), ['read-qor', 'synth-b']);
    const paused = await owner.call({ action: 'pause', nodeId: 'synthesize' });
    assert.equal(paused.kind, 'accepted');
    assert.deepEqual(owner.context().available, ['synth-b'], 'the dependent read and join are fenced; the sibling is independent');
    const blockedRead = await owner.call({ action: 'begin', nodeId: 'read-qor' });
    assert.equal(blockedRead.kind, 'refused');
    await owner.node('synth-b');
    await owner.node('read-qor-b');
    assert.equal(owner.launched().length, 2);
    assert.deepEqual(owner.context().available, [], 'one finished branch cannot make the join available');
    assert.equal((await owner.call({ action: 'begin', nodeId: 'judge' })).kind, 'refused');

    assert.equal((await owner.call({ action: 'continue', nodeId: 'synthesize' })).kind, 'accepted');
    assert.deepEqual(owner.context().available, ['read-qor']);
    await owner.node('read-qor');
    assert.deepEqual(owner.context().available, ['judge']);
    assert.equal(owner.launched().length, 2, 'closing the fork starts no other Job');
    await owner.node('judge');
    assert.equal(owner.context().run.status, 'ended-goal-not-met');
    assert.equal(owner.context().run.fork, undefined);

    const expectedBranch = new Map([['synthesize', 'synthesize'], ['read-qor', 'synthesize'], ['synth-b', 'synth-b'], ['read-qor-b', 'synth-b']]);
    const executions = owner.context().executions;
    assert.equal(new Set(executions.map((execution) => execution.id)).size, 6);
    for (const execution of executions) {
      assert.equal(execution.branchId, expectedBranch.get(execution.nodeId), `execution ${execution.nodeId} belongs to its branch`);
      assert.equal(execution.generation, 1);
      assert.equal(execution.loopId, undefined);
    }
    assert.deepEqual(owner.launched().map((record) => [record.nodeId, record.branchId]), [['synthesize', 'synthesize'], ['synth-b', 'synth-b']]);
    const records = recordsOf(host, runId);
    const observations = new Map(records.filter((record) => record.type === 'observation').filter((record) => record.branchId !== undefined).map((record) => [record.branchId, record.id]));
    const verdicts = records.filter((record) => record.type === 'verdict');
    assert.equal(verdicts.length, 4, 'two rules judge both branches, never just the last branch');
    for (const verdict of verdicts) {
      assert.ok(verdict.branchId);
      assert.deepEqual(verdict.cites, [observations.get(verdict.branchId)]);
    }
    assert.deepEqual(verdicts.map((record) => [record.branchId, record.ruleId, record.outcome]), [
      ['synthesize', 'setup-wns-all-nonnegative', 'FAIL'], ['synthesize', 'clock-period-at-most', 'PASS'],
      ['synth-b', 'setup-wns-all-nonnegative', 'PASS'], ['synth-b', 'clock-period-at-most', 'FAIL'],
    ]);
  });
});

test('a declared nested Loop exposes entry and each inner generation without helper-driven Jobs', async (t) => {
  await campaign(t, { variant: 'loop' }, async (owner, host, runId) => {
    const probe = await owner.ready('probe');
    assert.equal(owner.context().run.loop, undefined, 'work alone does not enter the declared Loop');
    await owner.complete('probe', probe);
    const loopId = owner.context().run.loop?.id;
    assert.ok(loopId);
    assert.equal(owner.context().run.loop?.name, 'push');
    assert.equal(owner.context().run.loop?.generation, 1);
    assert.deepEqual(owner.context().available, ['synthesize']);
    assert.equal(owner.launched().length, 0);
    assert.equal((await owner.call({ action: 'begin', nodeId: 'final-read' })).kind, 'refused', 'outer continuation waits for the Loop outcome');

    await owner.node('synthesize');
    await owner.node('read-qor');
    await owner.node('judge');
    const first = await owner.ready('next-period');
    await owner.complete('next-period', first, {
      decision: 'next-strategy', strategy: { periodNs: 2.3 },
      rationale: 'Repeat the same constraint to test the declared convergence condition.', cites: owner.cites(),
    });
    assert.equal(owner.context().run.generation, 1, 'the outer generation has not advanced');
    assert.equal(owner.context().run.loop?.generation, 2);
    assert.deepEqual(owner.context().available, ['synthesize']);
    assert.equal(owner.launched().length, 1, 'inner revisit exposes a candidate without starting it');

    await owner.node('synthesize');
    await owner.node('read-qor');
    await owner.node('judge');
    const second = await owner.ready('next-period');
    await owner.complete('next-period', second, {
      decision: 'converged', rationale: 'Two actual 2.30 ns observations satisfy the declared stability band; the 2.00 ns goal remains unmet.', cites: owner.cites(),
    });
    assert.equal(owner.context().run.loop, undefined);
    assert.deepEqual(owner.context().available, ['final-read']);
    assert.equal(owner.launched().length, 2, 'closing the Loop starts no outer node');
    const inner = owner.context().executions.filter((execution) => ['synthesize', 'read-qor', 'judge', 'next-period'].includes(execution.nodeId));
    assert.equal(inner.length, 8);
    assert.ok(inner.every((execution) => execution.loopId === loopId && execution.generation === 1 && execution.branchId === undefined));
    assert.deepEqual(inner.map((execution) => execution.loopGeneration), [1, 1, 1, 1, 2, 2, 2, 2]);
    const loops = recordsOf(host, runId).filter((record) => record.type === 'loop');
    assert.deepEqual(loops.map((record) => [record.event, record.loopId]), [['opened', loopId], ['closed', loopId]]);
    assert.equal(loops[1]?.outcome, 'converged');
    assert.equal(loops[1]?.generations, 2);
    await owner.node('final-read');
    assert.equal(owner.context().run.status, 'ended-goal-not-met', 'Loop convergence is not goal success');
    assert.equal(owner.launched().length, 2);
  });
});


test('an invalid fixed chooser recommendation does not veto a valid owner strategy', async (t) => {
  await campaign(t, { variant: 'bad-advice', goal: 2.0, period: 2.4 }, async (owner, host, runId) => {
    const method = owner.context().method;
    assert.ok(method);
    assert.equal(method.digest, owner.context().run.packDigest);
    const declared = method.reference.nodes.find((node) => node.id === 'next-period');
    assert.equal(declared?.kind, 'explore');
    if (declared?.kind === 'explore') assert.equal(declared.parameters.bind.stepNs, 20);
    await owner.node('synthesize');
    await owner.node('read-qor');
    await owner.node('judge');
    const executionId = await owner.ready('next-period');
    // The retained chooser computes 2.40 - 20 = -17.60, outside the positive period domain.
    await owner.complete('next-period', executionId, { decision: 'next-strategy', strategy: { periodNs: 2.3 },
      rationale: 'The declared recommendation has invalid arithmetic; explicitly test the valid 2.30 ns candidate.', cites: owner.cites() });
    assert.deepEqual(owner.context().run.strategy, { periodNs: 2.3 });
    assert.equal(owner.context().run.generation, 2);
    assert.equal(owner.launched().length, 1);
    const decision = recordsOf(host, runId).findLast((record) => record.type === 'decision');
    assert.equal(decision?.type, 'decision');
    if (decision?.type === 'decision') {
      assert.deepEqual(decision.chosen, { strategy: { periodNs: 2.3 } });
      assert.deepEqual(decision.rationale, {}, 'unrelated or invalid chooser numbers are not Agent decision facts');
      assert.equal(decision.agent?.executionId, executionId);
      assert.equal(decision.agent?.sessionId, owner.context().run.control?.owner);
      assert.match(decision.agent?.rationale ?? '', /invalid arithmetic/);
    }
  });
});

test('Pack wait needs a human clearance followed by explicit Agent completion', async (t) => {
  await campaign(t, { variant: 'wait' }, async (owner, host, runId) => {
    const executionId = await owner.ready('blocked');
    assert.deepEqual(owner.context().run.control?.paused, ['blocked']);
    assert.deepEqual(owner.context().available, []);
    const agentContinue = await owner.call({ action: 'continue' });
    assert.equal(agentContinue.kind, 'refused', 'an Agent cannot impersonate the required human clearance');
    assert.equal((await owner.call({ action: 'complete', nodeId: 'blocked', executionId })).kind, 'refused');
    assert.equal(recordsOf(host, runId).filter((record) => record.type === 'resumed').length, 0);
    const human = await owner.call({ action: 'continue', origin: 'human' });
    assert.equal(human.kind, 'accepted', JSON.stringify(human));
    assert.deepEqual(owner.context().run.control?.paused, []);
    assert.equal(owner.context().run.currentNode, 'blocked', 'clearance alone does not route or work');
    assert.equal(owner.execution(executionId).phase, 'ready');
    const resumed = recordsOf(host, runId).filter((record) => record.type === 'resumed');
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0]?.writer, 'person');
    await owner.complete('blocked', executionId);
    assert.deepEqual(owner.context().available, ['synthesize']);
    assert.equal(owner.launched().length, 0);
  });
});
