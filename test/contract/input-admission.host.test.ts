// PLS-21: public command/tool admission, isolated real Host and stand-in Site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFabric, waitUntil } from './support/fabric.ts';
import { siteCommandTimeoutMs } from './support/command.ts';
import { createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';
import { admissionProposal, confirmAdmission, admissionStatus } from './support/u9-admission.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('confirmed tool inputs reject invalid Goal values and preserve a lossless decimal', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // Raw duplicate/lossless-number parsing is covered by current HTTP admission in start-form.
    // /hima run no longer starts product Runs under ADR-0018.
    const agent = await createRootAgent(host.ctx, h.workspace);
    const { proposal } = await admissionProposal(host, h, timingProbePackId, { goal: { target_period_ns: 2.3 } });
    assert.equal(proposal.ready, true, JSON.stringify(proposal));
    for (const goal of [{ target_period_ns: NaN }, { target_period_ns: Infinity }, { target_period_ns: -1 }, { unknown: 2 }, { target_period_ns: '2.00000000000000001' }]) {
      const result = await host.ctx.tools.execute({ callId: 'admission-test' as never, name: 'hima_run', arguments: { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal, strategy: proposal.strategy }, agent, signal: AbortSignal.timeout(siteCommandTimeoutMs) });
      assert.equal(result.isError, true, JSON.stringify(result));
    }
    assert.deepEqual(await host.ctx.hima.durable.store.runs(), []);
    const result = await host.ctx.tools.execute({ callId: 'admission-valid' as never, name: 'hima_run', arguments: { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: { target_period_ns: '2.30' }, strategy: proposal.strategy }, agent, signal: AbortSignal.timeout(siteCommandTimeoutMs) });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = JSON.parse(result.content!.find(item => item.type === 'text')!.text!);
    assert.deepEqual((await host.ctx.hima.readExecutionContext(value.runId)).run.goal, { target_period_ns: 2.3 });
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
      const guide = await createRootAgent(host.ctx, h.workspace);
      const refused = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(guide.id) });
      if (refused.kind === 'preparing' || refused.kind === 'ran') {
        await waitUntil('unsafe bound input is refused before physical submit', async () => {
          const context = await host.ctx.hima.readExecutionContext(refused.run.id);
          return JSON.stringify(context.durable?.tasks).includes('literal data');
        });
        const view = await admissionStatus(host, guide, refused.run.id);
        assert.equal(view.jobs.length, 0, JSON.stringify(view.jobs));
      } else {
        assert.equal(refused.kind, 'unfit', JSON.stringify(refused));
        assert.match(JSON.stringify(refused), /literal data/);
      }
      for (const run of await host.ctx.hima.durable.store.runs()) {
        assert.equal((await admissionStatus(host, guide, run.runId)).jobs.length, 0);
      }
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
      const guide = await createRootAgent(host.ctx, h.workspace);
      const refused = await host.ctx.hima.startRun({ pack, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(guide.id) });
      if (refused.kind === 'preparing' || refused.kind === 'ran') {
        await waitUntil('unsafe bound input is refused before physical submit', async () => {
          const context = await host.ctx.hima.readExecutionContext(refused.run.id);
          return JSON.stringify(context.durable?.tasks).includes('literal data');
        });
        const view = await admissionStatus(host, guide, refused.run.id);
        assert.equal(view.jobs.length, 0, JSON.stringify(view.jobs));
      } else {
        assert.equal(refused.kind, 'unfit', JSON.stringify(refused));
        assert.match(JSON.stringify(refused), /literal data/);
      }
      assert.deepEqual(await host.ctx.hima.durable.store.runs(), []);
      await assert.rejects(access(marker), { code: 'ENOENT' });
    }
    await site(flow.design);
    const result = await confirmAdmission(host, h, pack, { goal: { target_period_ns: 2 }, budget: { generations: 1 } });
    await waitUntil('Reader task produces its sourced observation', async () => (await admissionStatus(host, result.guide, result.runId)).observations.some((record: any) => record.reader.id === 'count-candidates'));
    const view = await admissionStatus(host, result.guide, result.runId);
    const jobs = view.jobs;
    assert.ok(jobs.some((record: any) => record.event === 'launched' && record.job.workspace.includes('research with spaces')));
    const readings = view.observations;
    assert.ok(readings.some((record: any) => record.reader.id === 'count-candidates'), JSON.stringify(readings));
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
    const result = await confirmAdmission(host, h, timingProbePackId, { goal: { target_period_ns: 2 }, budget: { generations: 3 } });
    await waitUntil('the invalid chooser candidate is refused', async () => {
      const context = await host.ctx.hima.readExecutionContext(result.runId);
      return context.durable?.tasks?.some((task: any) => task.state?.state === 'failed' || task.state?.state === 'waiting') === true || context.durable?.workflow?.status === 'ERROR' || (context.durable?.outcome as { state?: string } | undefined)?.state === 'failed';
    });
    const context = await host.ctx.hima.readExecutionContext(result.runId);
    assert.match(JSON.stringify(context.durable), /invalid strategy knob/);
    assert.deepEqual(context.run.goal, { target_period_ns: 2 });
    const view = await admissionStatus(host, result.guide, result.runId);
    assert.equal(view.jobs.filter((record: any) => record.event === 'launched').length, 1);
    assert.equal(view.decisions?.length ?? 0, 0);
  } finally { await dispose(); }
});

test('independent confirmed model-tool Runs bind a newly declared relative Goal by its own name', async (t) => {
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
    const first = await confirmAdmission(host, h, pack, { goal: { improvement_pct: 25 }, budget: { generations: 1 } });
    const second = await confirmAdmission(host, h, pack, { goal: { improvement_pct: 5.25 }, budget: { generations: 1 } });
    assert.deepEqual([first.context.run.goal?.improvement_pct, second.context.run.goal?.improvement_pct].sort((a, b) => a! - b!), [5.25, 25]);
  } finally { await dispose(); }
});
