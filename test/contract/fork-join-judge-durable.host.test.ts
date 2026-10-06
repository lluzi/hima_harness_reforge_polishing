// L2 Host: a forking Pack through the normal startRun → DBOS route on a real local Site with the
// stand-in synthesis flow. The joined branches are followed by a fresh unbranched observation and a
// second Judge; the Explore decision must rest on that consolidated evidence, never on whichever
// branch happened to pass. No model call; the chooser and rules are the Pack's own.
// Replaces agent-graph.host.test.ts "fork exploration uses a fresh unbranched observation and Judge,
// never the last branch success" (owner begin/work/complete and a refused owner goal-met claim).
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { installFork, packsDirOf } from './support/pack.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const lib = (name: string) => import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib', `${name}.js`)).href);

/** The product's durable record projection (what the Run page and reports read), not SDK tables. */
async function recordsOf(host: InProcessHost, home: string, runId: string, type: 'observation' | 'verdict') {
  const { createDurableViewReaders } = await lib('durable-views');
  const service = host.ctx.hima;
  const readers = createDurableViewReaders({ ledger: service.ledger, judge: service.judge, durable: service.durable,
    host: host.ctx, sitesDir: path.join(home, 'hima/sites'), packsDir: path.join(home, 'hima/packs') });
  return await readers.readRunRecords(runId, type) as any[];
}

/** The fork variant plus a consolidation after the join: a fresh read of the main report, its own
 *  Judge, and the Explore decision downstream of that Judge (same graph the retired test drove). */
async function installConsolidatedFork(packsDir: string, generationLimit: number): Promise<string> {
  const pack = await installFork(packsDir, 'durable-fork-consolidated', 2.2);
  const graphFile = path.join(packsDir, pack, 'graph.yml');
  const graph = await readFile(graphFile, 'utf8');
  assert.ok(graph.includes('  - id: blocked\n    kind: wait'));
  await writeFile(graphFile, graph.replace('  - id: blocked\n    kind: wait', `  - id: consolidate
    kind: act
    parameters: { observes: qorReport }
  - id: consolidated-judge
    kind: judge
    parameters:
      rules: [setup-wns-all-nonnegative, clock-period-at-most]
      bind: { target_period_ns: { from: goal, name: target_period_ns } }
  - id: decide
    kind: explore
    parameters:
      chooser: timing-push
      bind: { guardBandNs: 0.05 }
      converge: { read: period, band: 0.05, generations: 1, generationLimit: ${generationLimit} }
  - id: blocked
    kind: wait`) + `
  - { from: judge, to: consolidate, outcome: PASS }
  - { from: judge, to: consolidate, outcome: FAIL }
  - { from: consolidate, to: consolidated-judge }
  - { from: consolidated-judge, to: decide, outcome: PASS }
  - { from: consolidated-judge, to: decide, outcome: FAIL }
  - { from: decide, to: start, revisit: true }
`);
  return pack;
}

// The stand-in closes at 2.20 ns: setup slack is min(0, period - 2.20). Branch synth-b always runs at
// 2.20 and passes both rules. At 2.00 the main branch (and so the consolidated reading) fails setup.
for (const scenario of [
  { name: 'a failing consolidated reading is not rescued by a passing branch', period: 2.0, goalMet: false, consolidated: ['FAIL', 'PASS'] },
  { name: 'a passing consolidated reading ends goal-met on that reading', period: 2.2, goalMet: true, consolidated: ['PASS', 'PASS'] },
] as const) {
  test(`DBOS fork Explore: ${scenario.name}`, { timeout: 150_000 }, async (t) => {
    const home = await localHome(t, { sleepSeconds: 0.01, parallelJobs: 2, licences: { 'Design-Compiler': 2 } });
    assert.ok(home);
    const pack = await installConsolidatedFork(packsDirOf(home.h), 1);
    const host = await bootInProcess(home.h);
    let runId: string | undefined;
    try {
      const owner = await createRootAgent(host.ctx, home.h.workspace);
      const started = await host.ctx.hima.startRun({ pack, site: 'local', ownerSessionId: String(owner.id),
        goal: { target_period_ns: 2.2 }, strategy: { periodNs: scenario.period }, generationLimit: 1 });
      assert.ok(started.kind === 'ran' || started.kind === 'preparing', JSON.stringify(started));
      if (started.kind !== 'ran' && started.kind !== 'preparing') return;
      runId = started.run.id;
      let context = await host.ctx.hima.readExecutionContext(runId);
      await waitUntil('the DBOS Run reaches its outcome', async () => {
        context = await host.ctx.hima.readExecutionContext(runId!);
        return !!context.durable?.outcome;
      }, 120_000, 100);
      const outcome = context.durable!.outcome as any;
      const tasks = (context.durable as any).tasks.map((task: any) => ({ id: task.identity.taskId, branches: task.branches, state: task.state }));
      const evidence = JSON.stringify({ status: context.run.status, outcome: { state: outcome.state, reason: outcome.reason }, tasks });
      assert.equal(outcome.state, 'succeeded', evidence);

      const observations = await recordsOf(host, home.h.home, runId, 'observation');
      const verdicts = await recordsOf(host, home.h.home, runId, 'verdict');
      const consolidatedId = outcome.committed.consolidate.value.observations[0].id as string;
      const branchB = observations.find(row => row.branchId === 'synth-b');
      assert.ok(branchB, `branch synth-b has its own reading: ${JSON.stringify(observations.map(row => ({ id: row.id, branchId: row.branchId })))}`);
      const consolidated = observations.find(row => row.id === consolidatedId);
      assert.ok(consolidated, 'the consolidated reading is a delivered observation');
      assert.equal(consolidated.branchId, undefined, 'the consolidated reading belongs to no branch');

      // The join Judge still records the passing branch: its success is real, only not the decision basis.
      assert.deepEqual(verdicts.filter(row => row.branchId === 'synth-b').map(row => row.outcome), ['PASS', 'PASS']);
      const fresh = verdicts.filter(row => row.cites.includes(consolidatedId));
      assert.deepEqual(fresh.map(row => row.outcome), [...scenario.consolidated], 'the fresh Judge reads the consolidated observation');
      assert.ok(fresh.every(row => row.branchId === undefined));

      const decision = outcome.committed.decide.value;
      assert.equal(decision.goalMet, scenario.goalMet, JSON.stringify(decision));
      assert.ok(decision.cites.includes(consolidatedId), 'the decision cites the consolidated observation');
      assert.ok(!decision.cites.includes(branchB.id), 'the decision never cites a branch reading');
      assert.ok(!decision.cites.some((id: string) => verdicts.some(row => row.id === id && row.branchId !== undefined)),
        'the decision never cites a branch verdict');
      if (scenario.goalMet) {
        assert.equal(decision.outcome, 'goal-met');
        assert.equal(context.run.status, 'ended-goal-met');
        assert.equal((context.run as any).goalState, 'met');
      } else {
        // The negative reading proposes the measured shortfall plus guard band; the allowance is spent.
        assert.deepEqual(decision.strategy, { periodNs: 2.25 });
        assert.equal(decision.outcome, 'generation-limit');
        assert.equal(context.run.status, 'ended-goal-not-met');
        assert.equal((context.run as any).goalState, 'not-met');
      }
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
      await host.dispose(); await home.h.dispose();
    }
  });
}
