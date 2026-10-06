// L2 Host: the released v2 AES probe Pack through the normal startRun → DBOS route, on a real local
// Site/Job loop. Only the EDA measurement is synthetic (a fixture probe.py at the Site boundary); the
// Pack's own Reader, rules, chooser and the durable Judge/Explore adapters are real. No model call.
// Replaces the owner begin/work/complete cases of aes-probe.test.ts ("the released v2 AES probe owns
// a real local Host/Job loop with goal-met | goal-missed | missing-measurement").
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeLocalSite } from './support/site.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { assertFixturePublication } from './support/u9-fixture-product-run.ts';

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

const probeFixture = `import argparse,json,hashlib,pathlib
p=argparse.ArgumentParser();p.add_argument('--workspace');p.add_argument('--period',type=float);a=p.parse_args()
f=pathlib.Path(a.workspace)/'flow'
raw='asked_period_ns\\t'+str(a.period)+'\\nworst_slack_ns\\t0\\ncell_area_um2\\t1024\\n'
(f/'metrics.tsv').write_text(raw)
ident={'schema':1,'inputs':{'fixture':'fixed'},'method':{'fixture':'fixed'},'tool':{'version':'synthetic'}}
ib=json.dumps(ident)
(f/'probe-inputs.json').write_text(ib)
(f/'probe.json').write_text(json.dumps({'effectiveIdentity':ident,'identity':{'path':'probe-inputs.json','sha256':hashlib.sha256(ib.encode()).hexdigest()},'format':'aes-probe/2','toolExit':0,'askedPeriodNs':a.period,'evidence':{'metrics':{'path':'metrics.tsv','sha256':hashlib.sha256(raw.encode()).hexdigest()}}}))
`;

for (const variant of ['goal-met', 'goal-missed', 'missing-measurement'] as const) {
  test(`released v2 AES probe through DBOS: ${variant} (synthetic EDA measurement)`,
    { timeout: 120_000 }, async (t) => {
    const home = await localHome(t, { sleepSeconds: 0 });
    assert.ok(home);
    const packDir = path.join(home.h.home, 'hima/packs/aes-tsmc28-dtco');
    await cp(path.join(repoRoot, 'docs/validation/pls-frontier/aes-execute-v2/pack'), packDir, { recursive: true });
    const flow = path.join(home.h.home, 'aes-mechanism-flow');
    await mkdir(flow);
    await writeFile(path.join(flow, 'probe.py'), variant === 'missing-measurement' ? 'raise SystemExit(2)\n' : probeFixture);
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/read-probe.py'), path.join(flow, 'read-probe.py'));
    await writeFile(path.join(flow, 'synth.tcl'), '# No EDA: this fixture does not invoke Tcl.\n');
    await writeFile(path.join(flow, 'inputs.json'), '{"fixture":"synthetic"}\n');
    await writeLocalSite(home.h, { allowedReadRoots: [home.h.workspace, flow], allowedWriteRoots: [home.h.workspace],
      allowedWrappers: ['/usr/bin/python3'], licences: { 'Design-Compiler': 1 },
      bindings: { flowRoot: flow, design: 'aes_cipher_top', workspaceRoot: home.h.workspace } });
    const host = await bootInProcess(home.h);
    let runId: string | undefined;
    try {
      const owner = await createRootAgent(host.ctx, home.h.workspace);
      const started = await host.ctx.hima.startRun({ pack: 'aes-tsmc28-dtco', site: 'local',
        goal: { target_period_ns: variant === 'goal-missed' ? 0.3 : 0.5 }, strategy: { periodNs: 0.5 },
        ownerSessionId: String(owner.id), generationLimit: 1, retryAllowance: 1, timeBoxMs: 90_000 });
      assert.ok(started.kind === 'ran' || started.kind === 'preparing', JSON.stringify(started));
      if (started.kind !== 'ran' && started.kind !== 'preparing') return;
      runId = started.run.id;
      let context = await host.ctx.hima.readExecutionContext(runId);
      await waitUntil('the DBOS Run reaches its outcome', async () => {
        context = await host.ctx.hima.readExecutionContext(runId!);
        return !!context.durable?.outcome;
      }, 90_000, 100);
      const outcome = context.durable!.outcome as any;
      const tasks = (context.durable as any).tasks.map((task: any) => ({ id: task.identity.taskId, state: task.state }));
      const observations = await recordsOf(host, home.h.home, runId, 'observation');
      const verdicts = await recordsOf(host, home.h.home, runId, 'verdict');
      const { readdir } = await import('node:fs/promises');
      const logs = Object.fromEntries(await Promise.all((await readdir(started.workspace)).filter(name => name.endsWith('.log'))
        .map(async name => [name, (await readFile(path.join(started.workspace, name), 'utf8')).slice(-1500)])));
      const evidence = JSON.stringify({ status: context.run.status, outcome: { state: outcome.state, reason: outcome.reason }, tasks, logs });

      if (variant === 'missing-measurement') {
        // A tool that published no measurement yields no reading, no verdict and no Goal claim.
        assert.equal(outcome.state, 'failed', evidence);
        assert.equal(tasks.find((task: any) => task.id === 'synthesize')?.state.state, 'failed', evidence);
        assert.equal(observations.length, 0);
        assert.equal(verdicts.length, 0);
        assert.equal(context.run.status, 'waiting', evidence);
        assert.equal((context.run as any).goalState, 'unknown');
        assert.ok(!tasks.some((task: any) => ['read-probe', 'judge', 'next-period'].includes(task.id)), 'no reading, Judge or decision runs without a measurement');
        return;
      }

      assert.equal(outcome.state, 'succeeded', evidence);
      assert.equal(observations.length, 1, evidence);
      const [observation] = observations;
      assert.deepEqual(observation.values.map((value: any) => [value.type, value.value]),
        [['clock_period', 0.5], ['setup_wns', 0], ['cell_area', 1024]], 'the reading is the hashed synthetic measurement');
      assert.deepEqual(verdicts.map(verdict => verdict.outcome), ['PASS', variant === 'goal-met' ? 'PASS' : 'FAIL'],
        'setup constraint first, then the Goal rule');
      assert.ok(verdicts.every(verdict => verdict.cites.includes(observation.id)), 'both verdicts cite the actual reading');
      const decision = outcome.committed['next-period'].value;
      assert.equal(decision.goalMet, variant === 'goal-met');
      assert.ok(decision.cites.includes(observation.id), 'the decision cites the reading it judged');
      if (variant === 'goal-met') {
        assert.equal(decision.outcome, 'goal-met');
        assert.equal(context.run.status, 'ended-goal-met');
        assert.equal((context.run as any).goalState, 'met');
      } else {
        // A met constraint at a missed Goal tightens one step; the generation allowance is spent.
        assert.deepEqual(decision.strategy, { periodNs: 0.49 });
        assert.equal(decision.outcome, 'generation-limit');
        assert.equal(context.run.status, 'ended-goal-not-met');
        assert.equal((context.run as any).goalState, 'not-met');
      }
      await waitUntil('the report and archive are delivered', async () => {
        try { await assertFixturePublication(host, runId!, home.h.home); return true; } catch { return false; }
      }, 30_000, 200);
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
      await host.dispose(); await home.h.dispose();
    }
  });
}
