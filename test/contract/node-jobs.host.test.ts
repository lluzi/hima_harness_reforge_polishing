// PLS-19 local mechanism tests: real Host, Jobs and files; no model or EDA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { writeLocalSite } from './support/site.ts';
import { tmuxHasSession } from './support/tmux.ts';
import { loadSite } from '@hima/harness';
import { claimSlotAndLaunch } from '@hima/harness';
import { installPack, installWorkshopPack, packReaderFile, packReaderScript } from './support/pack.ts';
import { loadPack, outputPath } from '@hima/harness';
import { buildWorkshopScope, launchWrittenWorkshop, resumeNode, toolNode, observeNode, exploreRecommendation, type Driving } from '@hima/harness';
import { writeIntoWorkshop, readForWorkshop, knowledgeForWorkshop } from '@hima/harness';
import { launchJob, reconcileLaunchIntent, jobStatus, type LaunchIntent } from '@hima/harness';

test('a durable launch intent must succeed before an actual Job can start', async () => {
  const h = await createHimaHome();
  const site = await writeLocalSite(h);
  const script = path.join(h.workspace, 'barrier.sh');
  await writeFile(script, 'sleep 20\n');
  const host = await bootInProcess(h);
  let offered = false;
  try {
    await assert.rejects(launchJob({ ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir }, {
      site: 'local', workspace: h.workspace, argv: ['sh', script], name: 'intent-fails',
      beforeLaunch: async (intent) => {
        offered = true;
        assert.equal(tmuxHasSession(intent.job.session), false, 'the intent precedes the actual session');
        assert.equal('pid' in intent.job, false, 'an unlaunched intent invents no process id');
        throw new Error('durable intent storage refused');
      },
    }), /durable intent storage refused/);
    assert.equal(offered, true);
    assert.equal(host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' })).length, 0);
  } finally {
    for (const r of host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' }))) {
      if (r.type === 'job' && r.event === 'launched') spawnSync('tmux', ['kill-session', '-t', `=${r.job.session}`]);
    }
    await host.dispose();
    await h.dispose();
  }
});

test('nonblocking capacity admission returns once and never launches when a slot later frees', async () => {
  const h = await createHimaHome();
  const site = await writeLocalSite(h);
  const script = path.join(h.workspace, 'holder.sh');
  await writeFile(script, 'sleep 2\n');
  const host = await bootInProcess(h);
  try {
    const deps = { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir };
    const first = await launchJob(deps, { site: 'local', workspace: h.workspace, argv: ['sh', script] });
    assert.equal(first.kind, 'launched');
    const started = Date.now();
    const answer = await claimSlotAndLaunch(deps, {
      site: loadSite(site.sitesDir, 'local'), run: first.run, workspace: h.workspace,
      node: { id: 'second', kind: 'act' }, attempt: 1, argv: ['sh', script],
      licences: {}, waitedMs: 0, nonblocking: true,
    });
    assert.equal(answer.kind, 'at-cap');
    assert.ok(Date.now() - started < 1000, 'capacity must not wait for the two-second Job');
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.equal(host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' })).filter((r) => r.type === 'job' && r.event === 'launched').length, 1, 'a returned at-cap request is not queued');
  } finally {
    for (const r of host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' }))) {
      if (r.type === 'job' && r.event === 'launched') spawnSync('tmux', ['kill-session', '-t', `=${r.job.session}`]);
    }
    await host.dispose(); await h.dispose();
  }
});

async function nodeHome() {
  const h = await createHimaHome();
  const installed = await installPack(h);
  const id = await installWorkshopPack(installed.packsDir);
  const siteFiles = await writeLocalSite(h);
  const host = await bootInProcess(h);
  const run = await host.ctx.hima.ledger.createRun({ campaignId: 'agent-job-mechanism', siteId: 'local', status: 'running', strategy: { periodNs: 2 } });
  const ctx: Driving = {
    deps: { ledger: host.ctx.hima.ledger, judge: host.ctx.hima.judge, sitesDir: siteFiles.sitesDir, packsDir: installed.packsDir },
    runId: run.id, site: loadSite(siteFiles.sitesDir, 'local'), pack: loadPack(installed.packsDir, id),
    bindings: { flowRoot: h.workspace, design: 'test', MINED_ROUTE: 'one' }, workspace: h.workspace,
    campaignId: run.campaignId, waitedMs: 0, nonblocking: true,
  };
  const dispose = async () => {
    for (const r of host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' }))) {
      if (r.type === 'job' && r.event === 'launched') spawnSync('tmux', ['kill-session', '-t', `=${r.job.session}`]);
    }
    await host.dispose(); await h.dispose();
  };
  return { h, host, run, ctx, dispose };
}

test('a nonblocking tool returns its real session; stopping the Host observer leaves that Job running', async () => {
  const home = await nodeHome();
  const { h, host, run, ctx } = home;
  try {
    const release = path.join(h.workspace, 'release');
    const script = path.join(h.workspace, 'wait.sh');
    await writeFile(script, `while [ ! -f '${release}' ]; do sleep 0.05; done\necho done\n`);
    const pack = { ...ctx.pack, contract: { ...ctx.pack.contract, tools: ctx.pack.contract.tools.map((t) => t.id === 'synth' ? { ...t, argv: ['sh', script], licences: {} } : t) } };
    const tool = pack.graph.nodes.find((n) => n.id === 'synthesize');
    assert.ok(tool?.kind === 'act');
    const launched = await toolNode({ ...ctx, pack }, run, tool, 1);
    assert.equal(launched.kind, 'pending');
    if (launched.kind !== 'pending') return;
    assert.equal(tmuxHasSession(launched.session), true);
    assert.equal(host.ctx.hima.ledger.run(run.id)?.meters?.attempts ?? 0, 0, 'the owning execution admission alone counts attempts');
    assert.equal(host.ctx.hima.ledger.run(run.id)?.meters?.jobsLaunched, 1);
    const stop = new AbortController();
    const observing = resumeNode({ ...ctx, pack, stopSignal: stop.signal }, tool, 1, launched.session);
    stop.abort();
    assert.equal((await observing).kind, 'stopped');
    assert.equal(tmuxHasSession(launched.session), true, 'observer shutdown does not kill the Site Job');
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).some((r) => r.type === 'job' && r.event === 'killed'), false);
    await writeFile(release, 'go');
    assert.equal((await resumeNode({ ...ctx, pack }, tool, 1, launched.session)).kind, 'settled');
  } finally { await home.dispose(); }
});

test('the conversational Agent writes isolated Workshop versions, and launch verifies every recorded file without a model moment', async () => {
  const home = await nodeHome();
  const { ctx, host } = home;
  try {
    const node = ctx.pack.graph.nodes.find((n) => n.id === 'mine');
    assert.ok(node?.kind === 'act');
    const first = await buildWorkshopScope({ ...ctx, executionId: 'execution-a' }, node, 1, 'conversation-owner');
    const second = await buildWorkshopScope({ ...ctx, executionId: 'execution-b' }, node, 2, 'conversation-owner');
    assert.equal(first.ok, true); assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.notEqual(first.resolved.entryAbs, second.resolved.entryAbs);
    assert.equal(first.resolved.produces.path, second.resolved.produces.path, 'the Pack output path never moves into the script directory');
    assert.ok(first.resolved.entryAbs.includes('/.executions/execution-a/'));
    const wrote = await writeIntoWorkshop(first.scope, 'miner.sh', 'echo first\n');
    assert.equal(wrote.wrote, true);
    assert.equal((await writeIntoWorkshop(first.scope, 'helper.sh', 'echo helper\n')).wrote, true);
    await writeFile(path.join(first.resolved.workshopAbs, 'helper.sh'), 'echo changed\n');
    const rejected = await launchWrittenWorkshop({ ...ctx, executionId: 'execution-a' }, node, 1, 'conversation-owner');
    assert.equal(rejected.kind, 'retrying', 'a changed helper invalidates the executable version too');
    assert.equal(host.ctx.hima.ledger.records({ runId: ctx.runId, type: 'job' }).length, 0);
    assert.equal((await writeIntoWorkshop(second.scope, '../escape.sh', 'bad')).wrote, false);
    assert.equal((await readForWorkshop(second.scope, 'undeclared-output')).read, false);
    const knowledge = await knowledgeForWorkshop(second.scope, second.resolved.knowledge[0]!.file);
    assert.ok(knowledge.text?.includes('candidate'));
    const release = path.join(home.h.workspace, 'workshop-release');
    assert.equal((await writeIntoWorkshop(second.scope, 'miner.sh', `while [ ! -f '${release}' ]; do sleep 0.05; done\necho second\n`)).wrote, true);
    const launched = await launchWrittenWorkshop({ ...ctx, executionId: 'execution-b' }, node, 2, 'conversation-owner');
    assert.equal(launched.kind, 'pending');
    if (launched.kind !== 'pending') return;
    assert.equal(tmuxHasSession(launched.session), true);
    assert.equal(host.ctx.hima.ledger.records({ runId: ctx.runId, type: 'session' }).length, 0, 'same-Agent code launch creates no model moment');
    const record = host.ctx.hima.ledger.records({ runId: ctx.runId, type: 'job' }).find((r) => r.type === 'job' && r.event === 'launched');
    assert.ok(record?.type === 'job');
    assert.equal(record.workshop?.entry.path, second.resolved.entryAbs);
    await writeFile(release, 'go');
    assert.equal((await resumeNode(ctx, node, 2, launched.session)).kind, 'settled');
  } finally { await home.dispose(); }
});

async function waitForFile(file: string, diagnostic: () => string = () => '', timeout = 20_000): Promise<string> {
  const until = Date.now() + timeout;
  for (;;) {
    try { const value = await readFile(file, 'utf8'); if (value.trim() !== '') return value; } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    assert.ok(Date.now() < until, `file barrier ${path.basename(file)} timed out: ${diagnostic()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

for (const window of ['before-launch', 'running-without-receipt', 'finished-without-receipt'] as const) {
  test(`a killed Host at ${window} reconciles the exact durable intent without relaunch`, async () => {
    const h = await createHimaHome();
    const site = await writeLocalSite(h);
    const description = path.join(h.workspace, 'home.json');
    const intentFile = path.join(h.workspace, 'intent.json');
    const script = path.join(h.workspace, 'job.sh');
    const release = path.join(h.workspace, 'release');
    const barrier = path.join(h.workspace, 'tmux-response-held');
    const shimDir = path.join(h.workspace, 'bin');
    await mkdir(shimDir);
    const actualTmux = spawnSync('which', ['tmux'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(path.isAbsolute(actualTmux));
    await writeFile(path.join(shimDir, 'tmux'), `#!/bin/sh\nif [ "$1" = new-session ]; then\n  '${actualTmux}' "$@" > '${barrier}.stdout'\n  result=$?\n  echo "$$" > '${barrier}'\n  while [ ! -f '${barrier}.release' ]; do sleep 0.05; done\n  cat '${barrier}.stdout'\n  exit "$result"\nfi\nexec '${actualTmux}' "$@"\n`, { mode: 0o755 });
    await writeFile(description, JSON.stringify(h));
    await writeFile(script, window === 'finished-without-receipt' ? 'echo completed\nexit 0\n' : `while [ ! -f '${release}' ]; do sleep 0.05; done\n`);
    const child = spawn(process.execPath, ['test/contract/support/node-launch-crash.ts', description, intentFile, script, window === 'before-launch' ? 'yes' : 'no'], {
      cwd: repoRoot, env: { ...h.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '';
    child.stdout.on('data', (data) => { diagnostic += data; }); child.stderr.on('data', (data) => { diagnostic += data; });
    const ended = new Promise<NodeJS.Signals | null>((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
    let intent: LaunchIntent | undefined;
    let shimPid: number | undefined;
    let restarted: Awaited<ReturnType<typeof bootInProcess>> | undefined;
    try {
      intent = JSON.parse(await waitForFile(intentFile, () => diagnostic));
      assert.ok(intent);
      if (window !== 'before-launch') {
        shimPid = Number(await waitForFile(barrier, () => diagnostic));
        assert.ok(Number.isInteger(shimPid) && shimPid > 1);
        if (window === 'finished-without-receipt') await waitForFile(path.join(intent.job.workspace, `${intent.job.session}.exit`));
        else assert.equal(tmuxHasSession(intent.job.session), true);
      }
      assert.equal(child.kill('SIGKILL'), true, 'the Host is alive at the exact file barrier');
      assert.equal(await ended, 'SIGKILL', 'the process ended by the actual kill, not graceful exit');
      if (shimPid !== undefined) { try { process.kill(shimPid, 'SIGKILL'); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err; } }
      restarted = await bootInProcess(h);
      const deps = { ledger: restarted.ctx.hima.ledger, sitesDir: site.sitesDir };
      assert.equal(deps.ledger.records({ runId: intent.runId, type: 'job' }).length, 0, 'no mock: the killed process never wrote a receipt');
      const answer = await reconcileLaunchIntent(deps, intent);
      if (window === 'before-launch') {
        assert.equal(answer.kind, 'uncertain', 'absence cannot prove whether a lost launch once ran');
        assert.equal(tmuxHasSession(intent.job.session), false);
        assert.equal(deps.ledger.records({ runId: intent.runId, type: 'job' }).length, 0);
      } else {
        assert.equal(answer.kind, 'reconciled');
        assert.equal(answer.record.job.pid, undefined, 'the killed response supplied no process id');
        assert.equal(answer.record.nodeId, 'mechanism-node');
        assert.equal(answer.record.branchId, 'mechanism-branch');
        assert.equal(answer.record.attempt, 2);
        assert.deepEqual(answer.record.licences, { fixture: 1 });
        assert.equal((await reconcileLaunchIntent(deps, intent)).kind, 'existing');
        assert.equal(deps.ledger.records({ runId: intent.runId, type: 'job' }).filter((r) => r.type === 'job' && r.event === 'launched').length, 1);
        const status = await jobStatus(deps, { run: intent.runId, session: intent.job.session });
        assert.equal(status.state.state, window === 'finished-without-receipt' ? 'finished' : 'running');
      }
    } finally {
      child.kill('SIGKILL'); await ended;
      if (shimPid !== undefined) { try { process.kill(shimPid, 'SIGKILL'); } catch { /* the owned shim may already have ended */ } }
      if (intent) spawnSync(actualTmux, ['kill-session', '-t', `=${intent.job.session}`]);
      await restarted?.dispose(); await h.dispose();
    }
  });
}

test('a nonblocking Pack reader returns its Job and only read-back can settle the observation', async () => {
  const home = await nodeHome();
  const { ctx, host, h } = home;
  try {
    const node = ctx.pack.graph.nodes.find((n) => n.id === 'read-candidates');
    assert.ok(node?.kind === 'act');
    const output = ctx.pack.contract.outputs.find((o) => o.name === 'candidates');
    assert.ok(output);
    const report = path.join(h.workspace, outputPath(output, ctx.bindings));
    await mkdir(path.dirname(report), { recursive: true });
    await writeFile(report, '{ "count": 10 }\n');
    const release = path.join(h.workspace, 'reader-release');
    const reader = path.join(ctx.deps.packsDir, ctx.pack.contract.id, packReaderFile);
    await writeFile(reader, `while [ ! -f '${release}' ]; do sleep 0.05; done\n${packReaderScript}`);
    const launched = await observeNode(ctx, node, 1);
    assert.equal(launched.kind, 'pending');
    if (launched.kind !== 'pending') return;
    assert.equal(tmuxHasSession(launched.session), true);
    assert.equal(host.ctx.hima.ledger.records({ runId: ctx.runId, type: 'observation' }).length, 0);
    assert.equal(host.ctx.hima.ledger.run(ctx.runId)?.meters?.attempts ?? 0, 0, 'admission owns the attempt count');
    await writeFile(release, 'go');
    assert.equal((await resumeNode(ctx, node, 1, launched.session)).kind, 'settled');
    const observation = host.ctx.hima.ledger.records({ runId: ctx.runId, type: 'observation' }).at(-1);
    assert.ok(observation?.type === 'observation');
    assert.equal(observation.values.find((v) => v.type === 'candidate_count')?.value, 10);
  } finally { await home.dispose(); }
});

test('the Pack chooser is readonly advice and does not accept its recommendation as an Agent decision', async () => {
  const home = await nodeHome();
  const { ctx, host } = home;
  try {
    const pack = loadPack(ctx.deps.packsDir, 'opene902-timing-probe');
    const node = pack.graph.nodes.find((n) => n.id === 'next-period');
    assert.ok(node?.kind === 'explore');
    const ledger = host.ctx.hima.ledger;
    // Typed fixture observations seed this advice test; they are not a claim about an EDA run.
    await ledger.appendObservation(ctx.runId, {
      path: 'fixture.rpt', contentSha256: 'a'.repeat(64), bytes: 10,
      reader: { id: 'advice-fixture', version: '1', reportKind: 'test-only', emits: ['clock_period', 'setup_wns'] },
      values: [{ type: 'clock_period', unit: 'ns', value: 2 }, { type: 'setup_wns', unit: 'ns', value: -0.10, mode: 'setup', scope: 'all' }],
    });
    await host.ctx.hima.judge.evaluate({ runId: ctx.runId, ruleIds: ['setup-wns-all-nonnegative', 'clock-period-at-most'], params: { target_period_ns: 1.9 } });
    await ledger.appendNode(ctx.runId, { nodeId: 'judge', kind: 'judge', state: 'done', attempt: 1 });
    const before = ledger.records({ runId: ctx.runId });
    const advice = exploreRecommendation({ ...ctx, pack }, node);
    assert.equal(advice.ok, true);
    if (!advice.ok) return;
    assert.ok('strategy' in advice.chosen);
    if (!('strategy' in advice.chosen)) return;
    assert.ok(Math.abs(Number(advice.chosen.strategy.periodNs) - 2.05) < 1e-9);
    assert.deepEqual(ledger.records({ runId: ctx.runId }), before);
    assert.equal(ledger.records({ runId: ctx.runId, type: 'decision' }).length, 0);
  } finally { await home.dispose(); }
});

test('an unresolved launch intent vetoes another Run inside the Site capacity claim before any Job starts', async () => {
  const home = await nodeHome();
  const { ctx, run, host } = home;
  let counted = 0;
  let offered = false;
  try {
    await assert.rejects(claimSlotAndLaunch({
      ...ctx.deps,
      beforeSlotClaim: async (siteName) => { assert.equal(siteName, 'local'); counted += 1; throw new Error('an earlier launch remains uncertain'); },
    }, {
      site: ctx.site, run, workspace: ctx.workspace, node: { id: 'another-run-node', kind: 'act' }, attempt: 1,
      argv: ['sh', '-c', 'exit 0'], licences: {}, waitedMs: 0, nonblocking: true,
      beforeLaunch: async () => { offered = true; },
    }), /earlier launch remains uncertain/);
    assert.equal(counted, 1);
    assert.equal(offered, false);
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).length, 0);
  } finally { await home.dispose(); }
});
