// PLS-21: public command/tool admission, isolated real Host and stand-in Site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFabric } from './support/fabric.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

test('command and tool inputs reject duplicate names and numeric spellings that change value', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const line = `/hima run ${timingProbePackId} --site local --generations 1`;
    for (const args of ['--goal target_period_ns=2 --goal target_period_ns=3', '--goal target_period_ns=2 --set periodNs=2 --set periodNs=3', '--goal target_period_ns=2.00000000000000001', '--goal target_period_ns=2 --set periodNs=2.00000000000000001', '--goal target_period_ns=', '--goal target_period_ns=2 --goal __proto__=2']) {
      const result = await himaCommand(host, h.workspace, `${line} ${args}`);
      assert.equal(result.kind, 'error', `${args}: ${result.text}`);
      assert.equal(result.runId, undefined);
    }
    const agent = await createRootAgent(host.ctx, h.workspace);
    for (const goal of [{ target_period_ns: NaN }, { target_period_ns: Infinity }, { target_period_ns: -1 }, { unknown: 2 }, { target_period_ns: '2.00000000000000001' }]) {
      const result = await host.ctx.tools.execute({ callId: 'admission-test' as never, name: 'hima_run', arguments: { pack: timingProbePackId, site: 'local', goal, generations: 1 }, agent, signal: AbortSignal.timeout(siteCommandTimeoutMs) });
      assert.equal(result.isError, true, JSON.stringify(result));
    }
    assert.deepEqual(host.ctx.hima.ledger.runs(), []);
    const result = await host.ctx.tools.execute({ callId: 'admission-valid' as never, name: 'hima_run', arguments: { pack: timingProbePackId, site: 'local', goal: { target_period_ns: '2.30' }, generations: 1 }, agent, signal: AbortSignal.timeout(siteCommandTimeoutMs) });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(host.ctx.hima.ledger.runs()[0]?.goal, { target_period_ns: 2.3 });
  } finally { await dispose(); }
});

test('a make expansion bound by a node is refused before any Job or escaping file exists', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const { readFile, writeFile, access } = await import('node:fs/promises');
    const path = await import('node:path');
    const { parse, stringify } = await import('yaml');
    const { packsDirOf } = await import('./support/pack.ts');
    const graphFile = path.join(packsDirOf(h), timingProbePackId, 'graph.yml');
    const original = await readFile(graphFile, 'utf8');
    const marker = path.join(h.workspace, 'escape-marker');
    for (const payload of [`$(shell touch ${marker})`, '`touch ' + marker + '`', '2\ntouch ' + marker, '2; touch ' + marker, "2'; touch " + marker + "; echo '"]) {
      const graph = parse(original);
      graph.nodes[0].parameters.arguments.PERIOD_NS = payload;
      await writeFile(graphFile, stringify(graph));
      const result = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2 --generations 1`);
      assert.equal(result.kind, 'error', result.text);
      assert.match(result.text, /literal data/);
      for (const run of host.ctx.hima.ledger.runs()) assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).length, 0);
      await assert.rejects(access(marker), { code: 'ENOENT' });
    }
  } finally { await dispose(); }
});

test('reader and tool paths preserve spaces while dynamic Site bindings cannot launch either wrapper', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, flow, host, dispose } = local;
  try {
    const { mkdir, access } = await import('node:fs/promises');
    const path = await import('node:path');
    const { packsDirOf, installPackReader } = await import('./support/pack.ts');
    const { writeLocalSite } = await import('./support/site.ts');
    const pack = await installPackReader(packsDirOf(h), 'reader-admission');
    const marker = path.join(h.workspace, 'reader-escape');
    const workspaceRoot = path.join(h.workspace, 'research with spaces');
    await mkdir(workspaceRoot);
    const site = async (design: string) => {
      const configured = await writeLocalSite(h, {
      allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace],
      bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot },
      });
      const { parse, stringify } = await import('yaml');
      const { readFile, writeFile } = await import('node:fs/promises');
      const file = path.join(h.home, 'hima/sites/local.yml');
      const data = parse(await readFile(file, 'utf8'));
      data.bindings.design = design;
      await writeFile(file, stringify(data));
      return configured;
    };
    for (const design of [`$(shell touch ${marker})`, `x; touch ${marker}`, `x\"; touch ${marker}; echo \"`, `x\ntouch ${marker}`]) {
      await site(design);
      const result = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal target_period_ns=2 --generations 1`);
      assert.equal(result.kind, 'error', result.text);
      assert.match(result.text, /literal data/);
      assert.deepEqual(host.ctx.hima.ledger.runs(), []);
      await assert.rejects(access(marker), { code: 'ENOENT' });
    }
    await site(flow.design);
    const result = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal target_period_ns=2 --generations 1`, siteCommandTimeoutMs);
    assert.equal(result.kind, 'success', result.text);
    assert.ok(result.runId, result.text);
    const jobs = host.ctx.hima.ledger.records({ runId: result.runId, type: 'job' });
    assert.ok(jobs.some((record) => record.type === 'job' && record.event === 'launched' && record.job.workspace.includes('research with spaces')));
    const readings = host.ctx.hima.ledger.records({ runId: result.runId, type: 'observation' });
    assert.ok(readings.some((record) => record.type === 'observation' && record.reader.id === 'count-candidates'), JSON.stringify(readings));
  } finally { await dispose(); }
});

test('a chooser candidate outside Strategy bounds cannot start a second generation or change the Goal', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const { readFile, writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { packsDirOf } = await import('./support/pack.ts');
    const file = path.join(packsDirOf(h), timingProbePackId, 'contract.yml');
    await writeFile(file, (await readFile(file, 'utf8')).replace('min: 0.5', 'min: 2.29'));
    const result = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2 --generations 3`);
    assert.equal(result.kind, 'error', result.text);
    assert.match(result.text, /invalid strategy knob/);
    assert.ok(result.runId, result.text);
    const run = host.ctx.hima.ledger.run(result.runId);
    assert.deepEqual(run?.goal, { target_period_ns: 2 });
    assert.equal(run?.generation, 1);
    const jobs = host.ctx.hima.ledger.records({ runId: result.runId, type: 'job' });
    assert.equal(jobs.filter((record) => record.type === 'job' && record.event === 'launched').length, 1);
    assert.equal(host.ctx.hima.ledger.records({ runId: result.runId, type: 'decision' }).length, 0);
  } finally { await dispose(); }
});

test('the command and model tool both bind a newly declared relative Goal by its own name', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const { readFile, writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { packsDirOf, writePackVariant } = await import('./support/pack.ts');
    const pack = 'relative-entry';
    await writePackVariant(packsDirOf(h), pack, [
      ['  target_period_ns:', '  improvement_pct:'],
      ['clock period at most, unit: ns', 'relative improvement, unit: "%"'],
    ]);
    const contract = path.join(packsDirOf(h), pack, 'contract.yml');
    await writeFile(contract, (await readFile(contract, 'utf8')) + '\ngoal:\n  improvement_pct: { type: number, unit: "%", min: 0, max: 100, default: 5, precision: 2 }\n');
    const graph = path.join(packsDirOf(h), pack, 'graph.yml');
    await writeFile(graph, (await readFile(graph, 'utf8')).replaceAll('name: target_period_ns', 'name: improvement_pct'));
    const command = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal improvement_pct=25 --generations 1`);
    assert.equal(command.kind, 'success', command.text);
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({ callId: 'relative-goal-tool' as never, name: 'hima_run', arguments: { pack, site: 'local', goal: { improvement_pct: '5.25' }, generations: 1 }, agent, signal: AbortSignal.timeout(siteCommandTimeoutMs) });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(host.ctx.hima.ledger.runs().map((run) => run.goal?.improvement_pct).sort((a, b) => a! - b!), [5.25, 25]);
  } finally { await dispose(); }
});
